# Zomato Restaurant Scraper

📦 **Open source · MIT:** [github.com/AnshumanAtrey/zomato-restaurant-scraper](https://github.com/AnshumanAtrey/zomato-restaurant-scraper)


Scrape restaurant listings from [Zomato](https://www.zomato.com) by city and cuisine. Get structured records with **name, phone, address, cuisines, rating, and cost for two** — no Zomato account required.

Built for B2B sales teams, food-tech researchers, ghost-kitchen operators, lead-gen agencies, and competitor intelligence.

## Quick start

1. **Pick a City** from the dropdown (Bangalore, Delhi NCR, Mumbai, Dubai, Singapore, etc. — 40 cities)
2. **Pick a Listing Type** (Best, All, Dinner, Breakfast)
3. **Optionally pick a Cuisine** filter (Biryani, Pizza, North Indian, Chinese, etc. — 24 options)
4. **Set how many restaurants** you want (default 50, up to 1000)
5. Click **Run**

Typical 50-restaurant scan completes in 3-7 minutes.

## What you get

Each restaurant is pushed as one dataset record:

| Field | Example |
|---|---|
| `name` | Truffles |
| `url` | https://www.zomato.com/bangalore/truffles-st-marks-road-central-bangalore/info |
| `slug` | truffles-st-marks-road-central-bangalore |
| `phone` | +91 80 4111 2400 |
| `address` | 22, St Marks Road, Bangalore |
| `cuisines` | American, Burger, Continental |
| `rating` | 4.5 |
| `costForTwo` | ₹800 |
| `city` | bangalore |
| `area` | Central Bangalore |
| `timestamp` | 2026-05-22T09:43:18Z |

A final `summary` record reports `restaurantsScraped`, `restaurantsFound`, `failures`, `duration`, and `sourceUrls`.

## Common use cases

### Build a B2B restaurant lead list
Pick `Mumbai`, `Best restaurants`, `maxRestaurants: 200`. Export the CSV. You now have 200 verified phone numbers + addresses for outreach.

### Scrape a specific cuisine in a specific city
Pick `Hyderabad`, `All restaurants`, `Cuisine: Biryani`, `maxRestaurants: 100`.

### Scrape a city not in the dropdown
Use the **Custom city** field under "Advanced overrides". Type `Tirunelveli`, `Erode`, `Coorg`, `Manali`, `Madurai`, `Varanasi` — auto-converted to the right Zomato URL.

### Scrape a category not in the dropdown
Use the **Custom cuisine** field. `Momos`, `Kebab`, `Hyderabadi`, `Awadhi` all work.

### Scrape an exact Zomato URL you already have
Paste it into **Custom URL** under "Advanced overrides". Overrides every other dropdown.

## Inputs

### Main fields

- **City** — Pick from 40 Zomato cities across India, UAE, Qatar, Oman, Malaysia, Singapore, Philippines, Sri Lanka, Portugal
- **Listing Type** — `Best restaurants` (curated top picks), `All restaurants`, `Dinner spots`, or `Breakfast spots`
- **Cuisine** — Optional filter across 24 cuisine categories, or "Any" for no filter
- **How many restaurants** — Cap on results (1-1000). Start with 20-50 to verify, then scale up
- **Scan depth**:
  - `Quick` — restaurant URLs + names only (fast, cheap, useful for bulk URL lists)
  - `Standard` — full data: phone, address, rating, cost (default — recommended for B2B leads)
  - `Deep` — full data with extra retries for blocked pages (slowest, highest yield)

### Advanced overrides (optional)

- **Custom city** — Type any Zomato city not in the dropdown. Auto-slugified
- **Custom cuisine** — Type any Zomato cuisine category not in the dropdown
- **Custom URL** — Paste any Zomato listing URL to scrape it directly. Overrides everything above

### Runtime

- **Run timeout (seconds)** — Hard kill after this many seconds (default 1800 = 30 min)

## How it works

1. **Listing page**: navigates to the constructed Zomato URL, scrolls to load lazy content, extracts all restaurant detail URLs (handles both `/info` and `/order` URL patterns)
2. **Detail pages**: visits each restaurant page concurrently using fast HTTP fetches (Cheerio) — typically 5-10x faster than full browser rendering
3. **Auto-fallback**: if the primary URL returns 0 restaurants, automatically retries `/{city}/restaurants` as a fallback

Uses **Apify Residential Proxy** to avoid rate-limit issues.

## Pricing

**$0.005 per restaurant record.** A typical 50-restaurant scan costs ~$0.26.

| Scan size | Approx cost |
|---|---|
| 20 restaurants | $0.10 |
| 50 restaurants | $0.25 |
| 100 restaurants | $0.50 |
| 500 restaurants | $2.50 |
| 1000 restaurants | $5.00 |

## FAQ

### Does it scrape menu items / dishes?
No — it scrapes restaurant *listings* (name, phone, address, etc.), not menus. For menu data, use a different actor that hits individual restaurant pages with menu rendering.

### Can I scrape "Dahi Puri" or "Tandoor"?
Zomato organizes by **cuisine category**, not by individual dish. Specific dishes like `dahi-puri` don't have their own URL on Zomato. Use a broader category like **Street Food** or **North Indian** instead.

### Can I scrape an entire state like "Tamil Nadu"?
Zomato has no state-level URLs. Pick a specific city instead — e.g., for Tamil Nadu use `Chennai`, `Coimbatore`, or custom-city `Madurai`/`Tirunelveli`.

### Does it work for cities outside the dropdown?
Yes. Use the **Custom city** field with the city name — `Erode`, `Coorg`, `Manali`, `Varanasi`, etc. The actor auto-slugifies and auto-falls-back to `/{city}/restaurants` if `/best-restaurants` doesn't exist for that smaller city.

### Why didn't I get any results?
Most likely causes:
- Off-list cuisine combined with quick scan — try `Standard` depth
- City has no listings for that cuisine — try removing the cuisine filter
- Custom URL is malformed — paste it in a browser first to verify

### What about international cities?
Dubai, Abu Dhabi, Sharjah (UAE), Doha (Qatar), Muscat (Oman), Kuala Lumpur (Malaysia), Singapore, Manila, Colombo, Lisbon are in the dropdown. Other Zomato international cities (e.g., Sydney, Auckland) work via the **Custom city** field.

### Is the data accurate / fresh?
Pulled live from Zomato at run time. Phone numbers and addresses are exactly what Zomato displays today. Ratings may lag slightly behind Zomato's internal scoring.

### Is this legal?
Scrapes only publicly visible data on Zomato. You are responsible for complying with Zomato's [Terms of Service](https://www.zomato.com/policies/terms-of-service/), GDPR/DPDP, and local laws. **Don't use phone numbers for mass cold-calling without consent.**

## Output structure

```json
{
  "recordType": "restaurant",
  "name": "Truffles",
  "url": "https://www.zomato.com/bangalore/truffles-st-marks-road-central-bangalore/info",
  "slug": "truffles-st-marks-road-central-bangalore",
  "phone": "+91 80 4111 2400",
  "address": "22, St Marks Road, Bangalore",
  "cuisines": ["American", "Burger", "Continental"],
  "rating": 4.5,
  "costForTwo": "₹800",
  "city": "bangalore",
  "area": "Central Bangalore",
  "timestamp": "2026-05-22T09:43:18Z"
}
```

Plus one `summary` record per run:

```json
{
  "recordType": "summary",
  "restaurantsScraped": 50,
  "restaurantsFound": 52,
  "failures": 2,
  "duration": 287,
  "sourceUrls": ["https://www.zomato.com/bangalore/best-restaurants"]
}
```

## Pairs nicely with

Enrich your restaurant lead lists with deeper intel:

- **[Holehe Email OSINT](https://apify.com/anshumanatrey/holehe-email-osint)** — After scraping restaurant emails from their websites, check which platforms each restaurant owner is on
- **[NetIntel](https://apify.com/anshumanatrey/netintel)** — WHOIS, DNS, SSL, GeoIP of each restaurant's website
- **[Social Analyzer](https://apify.com/anshumanatrey/social-analyzer)** — Find a restaurant brand's social media presence across 900+ platforms
- **[theHarvester](https://apify.com/anshumanatrey/theharvester-osint)** — Discover all subdomains + emails for a restaurant chain's primary domain
- **[nmap](https://apify.com/anshumanatrey/nmap-scanner)** — Network recon (for IT/security workflows, not lead-gen)
- **[Bug Bounty Finder](https://apify.com/anshumanatrey/bug-bounty-finder)** — Audit a restaurant chain's disclosure-program coverage

## Credits

Built by [Anshuman Atrey](https://apify.com/anshumanatrey) using Apify SDK, Crawlee, Puppeteer, and Cheerio.

## Disclaimer

This scraper accesses publicly available data on Zomato. You are responsible for complying with Zomato's [Terms of Service](https://www.zomato.com/policies/terms-of-service/) and applicable laws in your jurisdiction. Use the data responsibly — avoid mass cold-calling without consent.
