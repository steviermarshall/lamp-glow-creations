// The schema.org block in every page's head that tells search engines what Lamp is: a financial
// service brokering for businesses across the U.S. Built from SITE, so an empty field (phone,
// address) is left out instead of shipping as a blank.

type SiteFacts = {
  name: string;
  legalName: string;
  url: string;
  email: string;
  phone: string;
  address: string;
  areaServed: readonly string[];
};

type PostalAddress = {
  "@type": "PostalAddress";
  streetAddress: string;
  addressLocality?: string;
  addressRegion?: string;
  postalCode?: string;
  addressCountry: "US";
};

/**
 * One-line mailing address ("123 Main St, Roselle, NJ 07203") as a schema.org PostalAddress.
 * When the line doesn't end in "City, ST 12345" the whole line goes in streetAddress, so a
 * typed address is never dropped or split wrong.
 */
export function postalAddress(line: string): PostalAddress {
  const text = line.trim().replace(/\s+/g, " ");
  const m = /^(.+),\s*([^,]+),\s*([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?)$/.exec(text);
  if (!m) return { "@type": "PostalAddress", streetAddress: text, addressCountry: "US" };
  return {
    "@type": "PostalAddress",
    streetAddress: m[1]!.trim(),
    addressLocality: m[2]!.trim(),
    addressRegion: m[3]!.toUpperCase(),
    postalCode: m[4]!,
    addressCountry: "US",
  };
}

export function orgJsonLd(site: SiteFacts) {
  return {
    "@context": "https://schema.org",
    "@type": "FinancialService",
    name: site.name,
    legalName: site.legalName,
    url: site.url,
    logo: `${site.url}/apple-touch-icon.png`,
    image: `${site.url}/og.png`,
    email: site.email,
    ...(site.phone ? { telephone: site.phone } : {}),
    ...(site.address.trim() ? { address: postalAddress(site.address) } : {}),
    description:
      "Small-business working capital brokerage. Lamp shops a merchant's file to third-party funders and lays the offers out side by side in plain English.",
    areaServed: site.areaServed.map((name) => ({ "@type": "Country", name })),
  };
}
