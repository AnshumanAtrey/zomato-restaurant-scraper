// Zomato Restaurant Scraper — HYBRID architecture for cost efficiency.
//
// Stage 1: PuppeteerCrawler for the listing page (only this needs JS — scroll-loading)
//          Extracts /info URLs for every restaurant.
// Stage 2: CheerioCrawler (HTTP + cheerio, no browser) for detail pages.
//          Pulls name/phone/address/cuisines/rating/cost directly from SSR'd HTML.
//
// Why hybrid: Zomato's listing is infinite-scroll JS (Puppeteer unavoidable).
// Detail pages are server-side rendered — plain HTTP is ~10× faster + 16× less memory.

import { Actor, log } from 'apify';
import { PuppeteerCrawler, CheerioCrawler } from 'crawlee';

await Actor.init();

const input = (await Actor.getInput()) ?? {};

// User-facing fields (the friendly schema)
const {
    city = 'bangalore',
    listingType = 'best-restaurants',
    cuisine = '',
    maxRestaurants = 50,
    scanDepth = 'standard',
    customCity = '',
    customCuisine = '',
    customUrl = '',
    timeoutSeconds = 1800,
} = input;

// Slugify any user-typed text into the kebab-case form Zomato URLs expect.
// "Dahi Puri" → "dahi-puri", "Tamil Nadu" → "tamil-nadu", "  KOCHI " → "kochi"
function slugify(s) {
    return (s || '')
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')   // drop non-alphanumerics except space/dash
        .replace(/\s+/g, '-')             // spaces → dash
        .replace(/-+/g, '-')              // collapse multi-dash
        .replace(/^-|-$/g, '');           // trim leading/trailing dashes
}

// Translate user choices → internal mechanics (hidden from the schema)
// scanDepth maps:                  quick    standard  deep
// skipRestaurantDetails:           true     false     false
// scrollWaitMs:                    2000     2500      5000
// maxScrollAttempts:                15       30        60
const SCAN_DEPTH_MAP = {
    quick:    { skipRestaurantDetails: true,  scrollWaitMs: 2000, maxScrollAttempts: 15 },
    standard: { skipRestaurantDetails: false, scrollWaitMs: 2500, maxScrollAttempts: 30 },
    deep:     { skipRestaurantDetails: false, scrollWaitMs: 5000, maxScrollAttempts: 60 },
};
const depthSettings = SCAN_DEPTH_MAP[scanDepth] || SCAN_DEPTH_MAP.standard;
const { skipRestaurantDetails, scrollWaitMs, maxScrollAttempts } = depthSettings;

// Build the actual Zomato URL from the user's choices.
// Precedence: customUrl > (customCity / customCuisine) > dropdowns.
// Returns BOTH primary AND fallback URL. Fallback is used if primary yields 0 results.
function buildStartUrls() {
    if (customUrl && customUrl.trim().startsWith('http')) {
        return [customUrl.trim()];
    }
    const citySlug = slugify(customCity) || slugify(city) || 'bangalore';
    const cuisineSlug = slugify(customCuisine) || slugify(cuisine);
    const primary = cuisineSlug
        ? `https://www.zomato.com/${citySlug}/restaurants/${cuisineSlug}`
        : `https://www.zomato.com/${citySlug}/${listingType || 'best-restaurants'}`;
    // Fallback: smaller cities often lack /best-restaurants — fall back to /restaurants
    const fallback = `https://www.zomato.com/${citySlug}/restaurants`;
    return primary === fallback ? [primary] : [primary, fallback];
}
const candidateUrls = buildStartUrls();
const startUrls = [{ url: candidateUrls[0] }];
const fallbackUrl = candidateUrls[1] || null;  // used only if primary yields 0 restaurants

// Match the field name used downstream (was `maxRestaurantsPerCity`)
const maxRestaurantsPerCity = Math.max(1, Math.min(1000, Number(maxRestaurants) || 50));

log.info('Zomato Scraper (hybrid) starting');
log.info(`Resolved URL: ${candidateUrls[0]}${fallbackUrl ? ` (fallback: ${fallbackUrl})` : ''}`);
log.info(`Max restaurants: ${maxRestaurantsPerCity}`);
log.info(`Scan depth: ${scanDepth} (skipDetails=${skipRestaurantDetails}, scrollWait=${scrollWaitMs}ms, attempts=${maxScrollAttempts})`);

const startTime = Date.now();
// Apify Residential Proxy is ALWAYS on — user shouldn't need to know about proxies
const proxyConfiguration = await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'] });

const stats = { listingsProcessed: 0, restaurantsFound: 0, restaurantsScraped: 0, failures: 0 };

const cityFromUrl = (url) => {
    try {
        const m = new URL(url).pathname.match(/^\/([a-z-]+)\//i);
        return m ? m[1] : null;
    } catch {
        return null;
    }
};

const cleanText = (s) => (s ?? '').replace(/\s+/g, ' ').replace(/ /g, ' ').trim();

// ========================================================================
// STAGE 1 — PuppeteerCrawler: scroll listings, extract /info URLs
// ========================================================================
const detailUrls = [];
const urlToCity = new Map();

const listingCrawler = new PuppeteerCrawler({
    proxyConfiguration,
    launchContext: {
        launchOptions: {
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        },
    },
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 240,
    maxRequestRetries: 2,
    maxConcurrency: 2,

    async requestHandler({ page, request, log: rlog }) {
        const url = request.url;
        const city = cityFromUrl(url);
        stats.listingsProcessed += 1;
        rlog.info(`[LISTING] ${url} (city=${city})`);

        // Smaller cities use /order URLs instead of /info — match BOTH patterns.
        await page.waitForSelector('a[href*="/info"], a[href*="/order"]', { timeout: 30000 }).catch(() => {});

        // Scroll-load (counts unique restaurant slugs across BOTH /info and /order endpoints)
        let prev = 0;
        let stagnant = 0;
        for (let i = 0; i < maxScrollAttempts; i++) {
            const count = await page.evaluate(() => {
                const slugs = new Set();
                document.querySelectorAll('a[href*="/info"], a[href*="/order"]').forEach((a) => {
                    const m = a.getAttribute('href')?.match(/^\/?([a-z-]+)\/([a-z0-9_-]+)\/(?:info|order)$/i);
                    if (m && m[2]) slugs.add(m[2]);
                });
                return slugs.size;
            });
            if (count >= maxRestaurantsPerCity) break;
            if (count === prev) {
                stagnant += 1;
                if (stagnant >= 3) break;
            } else {
                stagnant = 0;
            }
            prev = count;
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await new Promise((r) => setTimeout(r, scrollWaitMs));
        }

        // Collect URLs — prefer /info when same slug has both, else use /order
        const urls = await page.evaluate(() => {
            const bySlug = new Map();  // slug → URL (prefer /info)
            document.querySelectorAll('a[href*="/info"], a[href*="/order"]').forEach((a) => {
                const href = a.getAttribute('href');
                if (!href) return;
                const m = href.match(/^\/?([a-z-]+)\/([a-z0-9_-]+)\/(info|order)$/i);
                if (!m) return;
                const slug = m[2];
                const kind = m[3];
                const abs = href.startsWith('http') ? href : `https://www.zomato.com${href}`;
                // Prefer /info over /order if both exist
                if (!bySlug.has(slug) || kind === 'info') bySlug.set(slug, abs);
            });
            return Array.from(bySlug.values());
        });

        const capped = urls.slice(0, maxRestaurantsPerCity);
        stats.restaurantsFound += capped.length;
        rlog.info(`[LISTING] ${capped.length} restaurant URLs collected (cap ${maxRestaurantsPerCity})`);

        for (const u of capped) {
            detailUrls.push(u);
            urlToCity.set(u, city);
        }
    },

    async failedRequestHandler({ request }, err) {
        stats.failures += 1;
        log.warning(`[LISTING] failed ${request.url} → ${err.message}`);
    },
});

const listingRequests = startUrls.map((u) => ({ url: u.url, label: 'LISTING' }));
await listingCrawler.run(listingRequests);

// Auto-fallback: if primary URL returned 0 restaurants AND a fallback URL exists, try it
if (detailUrls.length === 0 && fallbackUrl) {
    log.info(`Primary URL yielded 0 restaurants — trying fallback: ${fallbackUrl}`);
    const fallbackCrawler = new PuppeteerCrawler({
        proxyConfiguration,
        launchContext: { launchOptions: { args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] } },
        navigationTimeoutSecs: 60,
        requestHandlerTimeoutSecs: 240,
        maxRequestRetries: 2,
        maxConcurrency: 1,
        async requestHandler({ page, request, log: rlog }) {
            const city = cityFromUrl(request.url);
            await page.waitForSelector('a[href*="/info"], a[href*="/order"]', { timeout: 30000 }).catch(() => {});
            // Same scroll-load pattern, fewer attempts to keep runtime sane
            let prev = 0, stagnant = 0;
            for (let i = 0; i < Math.min(maxScrollAttempts, 20); i++) {
                const count = await page.evaluate(() => {
                    const slugs = new Set();
                    document.querySelectorAll('a[href*="/info"], a[href*="/order"]').forEach((a) => {
                        const m = a.getAttribute('href')?.match(/^\/?([a-z-]+)\/([a-z0-9_-]+)\/(?:info|order)$/i);
                        if (m && m[2]) slugs.add(m[2]);
                    });
                    return slugs.size;
                });
                if (count >= maxRestaurantsPerCity) break;
                if (count === prev) { stagnant += 1; if (stagnant >= 3) break; } else { stagnant = 0; }
                prev = count;
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await new Promise((r) => setTimeout(r, scrollWaitMs));
            }
            const fbUrls = await page.evaluate(() => {
                const bySlug = new Map();
                document.querySelectorAll('a[href*="/info"], a[href*="/order"]').forEach((a) => {
                    const href = a.getAttribute('href');
                    if (!href) return;
                    const m = href.match(/^\/?([a-z-]+)\/([a-z0-9_-]+)\/(info|order)$/i);
                    if (!m) return;
                    const abs = href.startsWith('http') ? href : `https://www.zomato.com${href}`;
                    if (!bySlug.has(m[2]) || m[3] === 'info') bySlug.set(m[2], abs);
                });
                return Array.from(bySlug.values());
            });
            const capped = fbUrls.slice(0, maxRestaurantsPerCity);
            stats.restaurantsFound += capped.length;
            rlog.info(`[FALLBACK LISTING] ${capped.length} restaurant URLs collected from fallback`);
            for (const u of capped) {
                detailUrls.push(u);
                urlToCity.set(u, city);
            }
        },
    });
    await fallbackCrawler.run([{ url: fallbackUrl, label: 'LISTING' }]);
}

log.info(`Stage 1 done — ${detailUrls.length} URLs collected. Browser closing.`);

if (skipRestaurantDetails) {
    for (const u of detailUrls) {
        const slug = u.split('/').filter(Boolean).slice(-2, -1)[0] || null;
        await Actor.pushData({
            recordType: 'restaurant',
            url: u,
            name: null,
            slug,
            city: urlToCity.get(u),
            phone: null,
            address: null,
            cuisines: null,
            rating: null,
            costForTwo: null,
            timestamp: new Date().toISOString(),
        });
        stats.restaurantsScraped += 1;
    }
} else {
    // ========================================================================
    // STAGE 2 — CheerioCrawler: HTTP+cheerio, no browser, fast.
    // ========================================================================
    const detailCrawler = new CheerioCrawler({
        proxyConfiguration,
        navigationTimeoutSecs: 30,
        requestHandlerTimeoutSecs: 30,
        maxRequestRetries: 2,
        maxConcurrency: 10,
        additionalMimeTypes: ['text/html', 'application/xhtml+xml'],

        async requestHandler({ request, $, log: rlog }) {
            const url = request.url;
            const city = request.userData?.city || cityFromUrl(url);

            // Name — h1 first, fallback to og:title (before the first comma)
            const ogTitle = $('meta[property="og:title"]').attr('content') || '';
            const h1 = cleanText($('h1').first().text());
            const name = h1 || cleanText(ogTitle.split('|')[0] || '');

            // Phone — tel: links (most reliable)
            const phones = new Set();
            $('a[href^="tel:"]').each((_, el) => {
                const t = ($(el).attr('href') || '').replace(/^tel:/, '').trim();
                if (t) phones.add(t);
            });
            const phone = Array.from(phones).join(', ') || null;

            // Get the page text once for regex-based extraction
            const bodyText = $('body').text().replace(/\s+/g, ' ');

            // Parse area + city from og:title now (used by both address-fallback and `area` field)
            const titleParts = ogTitle.split('|')[0].split(',').map((s) => s.trim()).filter(Boolean);
            const area = titleParts.length >= 3 ? titleParts[titleParts.length - 2] : null;
            const cityFromTitle = titleParts.length >= 2 ? titleParts[titleParts.length - 1] : null;

            // Address — find best candidate from short text snippets containing street keywords + digits
            // Expanded keywords + length range to catch more cases (hotels, complexes, etc.)
            const candidates = [];
            $('p, div, span').each((_, el) => {
                const t = cleanText($(el).text());
                if (t && t.length > 15 && t.length < 350) candidates.push(t);
            });
            const STREET_RE = /\b(road|street|nagar|lane|avenue|sector|block|floor|complex|colony|phase|opp|near|behind|cross|main\s+road|circle|tower|marg|khand|vihar|chowk|estate|park|hills?|building|plaza|mall|square|junction|gate|hotel|landmark)\b/i;
            // Reject candidates that are scraped meta blobs (Zomato's React class names + rating UI text)
            const BAD_RE = /(star-fill|Dining Ratings?|Delivery Ratings?|\d\.\d\s*Ratings?|svg|xmlns|innerHTML|className|aria-label|role=)/i;
            // Reject UI-blob patterns: digits concatenated to long words like "180Dining", "431Delivery"
            // Allow natural ordinals like "3rd Floor", "21st Cross" by requiring 2+ digits AND 4+ letter chars
            const CONCAT_RE = /\d{2,}[A-Za-z]{4,}/;
            const addressMatches = candidates.filter(
                (t) =>
                    STREET_RE.test(t) &&
                    /\d/.test(t) &&
                    !BAD_RE.test(t) &&
                    !CONCAT_RE.test(t) &&
                    !/^\d+\s+ratings?$/i.test(t) &&
                    !/cost for two/i.test(t) &&
                    !/^cuisines?/i.test(t) &&
                    !/^\s*Direction/i.test(t) &&
                    // Real addresses contain at least one comma OR a clearly numeric house/door prefix
                    (t.includes(',') || /^\s*(?:no\.?\s*)?\d{1,4}[/,-]/i.test(t)),
            );

            // Bias toward candidates that mention the og:title area (highest-confidence signal)
            let address = null;
            if (addressMatches.length) {
                if (area) {
                    const withArea = addressMatches.filter((t) => t.toLowerCase().includes(area.toLowerCase()));
                    if (withArea.length) {
                        address = withArea.sort((a, b) => a.length - b.length)[0];
                    }
                }
                if (!address) {
                    address = addressMatches.sort((a, b) => a.length - b.length)[0];
                }
            }

            // Fallback — synthesize area-level address from og:title when full street isn't in HTML
            // (hotel-restaurants etc. lazy-load their address; this gives at minimum "Area, City")
            if (!address && area && cityFromTitle) {
                address = `${area}, ${cityFromTitle}`;
            }

            // Cuisines — find element labelled "Cuisines" and grab sibling text
            let cuisines = null;
            $('p, section, div, span').each((_, el) => {
                const text = cleanText($(el).text());
                if (text.toLowerCase() === 'cuisines' && !cuisines) {
                    const sibling = $(el).next();
                    const sibText = cleanText(sibling.text());
                    if (sibText && sibText.length < 500) cuisines = sibText;
                }
            });
            // Fallback: cuisine-like links
            if (!cuisines) {
                const cuisineLinks = new Set();
                $('a[href*="/restaurants/"]').each((_, el) => {
                    const t = cleanText($(el).text());
                    if (t && t.length < 30 && /^[A-Z]/.test(t)) cuisineLinks.add(t);
                });
                if (cuisineLinks.size) cuisines = Array.from(cuisineLinks).slice(0, 10).join(', ');
            }

            // Rating — first 1-5 numeric near "Dining" or "Delivery" labels
            let rating = null;
            const ratingMatch = bodyText.match(/\b([1-4]\.\d|5\.0)\b/);
            if (ratingMatch) rating = ratingMatch[1];

            // Cost for two — ₹ or $ value
            let costForTwo = null;
            const costMatch = bodyText.match(/(?:cost for two[^₹$]*)?([₹$]\s?\d[\d,]*)/i)
                || bodyText.match(/([₹$]\s?\d[\d,]*)/);
            if (costMatch) costForTwo = costMatch[1].trim();

            // (area + cityFromTitle already parsed above for address fallback)

            await Actor.pushData({
                recordType: 'restaurant',
                url,
                slug: url.split('/').filter(Boolean).slice(-2, -1)[0] || null,
                city,
                name,
                phone,
                address,
                cuisines,
                rating,
                costForTwo,
                area,
                timestamp: new Date().toISOString(),
            });
            stats.restaurantsScraped += 1;
            rlog.info(`[DETAIL] ${name} (phone=${phone || 'n/a'})`);
        },

        async failedRequestHandler({ request }, err) {
            stats.failures += 1;
            log.warning(`[DETAIL] failed ${request.url} → ${err.message}`);
        },
    });

    const detailRequests = detailUrls.map((u) => ({
        url: u,
        label: 'DETAIL',
        userData: { city: urlToCity.get(u) },
    }));
    await detailCrawler.run(detailRequests);
}

const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
await Actor.pushData({
    recordType: 'summary',
    sourceUrls: startUrls.map((u) => u.url),
    listingsProcessed: stats.listingsProcessed,
    restaurantsFound: stats.restaurantsFound,
    restaurantsScraped: stats.restaurantsScraped,
    failures: stats.failures,
    duration: parseFloat(durationSec),
    architecture: 'hybrid (puppeteer-listing + cheerio-detail)',
    timestamp: new Date().toISOString(),
});

log.info(
    `Done — ${stats.restaurantsScraped}/${stats.restaurantsFound} restaurants in ${durationSec}s, ${stats.failures} failures`,
);

await Actor.exit();
