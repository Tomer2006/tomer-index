// UN Statistics Division M49 geographic groupings, checked 2026-09-09.
// https://unstats.un.org/unsd/methodology/m49/
// These are country filters; they do not replace World Bank aggregate scores.
export const GEOGRAPHIC_REGIONS = [
  ["015", "Northern Africa", "DZA EGY LBY MAR SDN TUN ESH"],
  [
    "014",
    "Eastern Africa",
    "IOT BDI COM DJI ERI ETH ATF KEN MDG MWI MUS MYT MOZ REU RWA SYC SOM SSD UGA TZA ZMB ZWE",
  ],
  ["017", "Middle Africa", "AGO CMR CAF TCD COG COD GNQ GAB STP"],
  ["018", "Southern Africa", "BWA SWZ LSO NAM ZAF"],
  [
    "011",
    "Western Africa",
    "BEN BFA CPV CIV GMB GHA GIN GNB LBR MLI MRT NER NGA SHN SEN SLE TGO",
  ],
  [
    "029",
    "Caribbean",
    "AIA ATG ABW BHS BRB BES VGB CYM CUB CUW DMA DOM GRD GLP HTI JAM MTQ MSR PRI BLM KNA LCA MAF VCT SXM TTO TCA VIR",
  ],
  ["013", "Central America", "BLZ CRI SLV GTM HND MEX NIC PAN"],
  [
    "005",
    "South America",
    "ARG BOL BVT BRA CHL COL ECU FLK GUF GUY PRY PER SGS SUR URY VEN",
  ],
  ["021", "Northern America", "BMU CAN GRL SPM USA"],
  ["143", "Central Asia", "KAZ KGZ TJK TKM UZB"],
  ["030", "Eastern Asia", "CHN HKG MAC PRK JPN MNG KOR"],
  ["035", "South-eastern Asia", "BRN KHM IDN LAO MYS MMR PHL SGP THA TLS VNM"],
  ["034", "Southern Asia", "AFG BGD BTN IND IRN MDV NPL PAK LKA"],
  [
    "145",
    "Western Asia",
    "ARM AZE BHR CYP GEO IRQ ISR JOR KWT LBN OMN QAT SAU PSE SYR TUR ARE YEM",
  ],
  ["151", "Eastern Europe", "BLR BGR CZE HUN POL MDA ROU RUS SVK UKR"],
  [
    "154",
    "Northern Europe",
    "ALA DNK EST FRO FIN GGY ISL IRL IMN JEY LVA LTU NOR SJM SWE GBR",
  ],
  [
    "039",
    "Southern Europe",
    "ALB AND BIH HRV GIB GRC VAT ITA MLT MNE MKD PRT SMR SRB SVN ESP",
  ],
  ["155", "Western Europe", "AUT BEL FRA DEU LIE LUX MCO NLD CHE"],
  ["053", "Australia and New Zealand", "AUS CXR CCK HMD NZL NFK"],
  ["054", "Melanesia", "FJI NCL PNG SLB VUT"],
  ["057", "Micronesia", "GUM KIR MHL FSM NRU MNP PLW UMI"],
  ["061", "Polynesia", "ASM COK PYF NIU PCN WSM TKL TON TUV WLF"],
].map(([code, name, members]) => ({
  id: `UN-${code}`,
  name,
  members: members.split(" "),
}));

const byCountry = new Map(
  GEOGRAPHIC_REGIONS.flatMap((region) =>
    region.members.map((iso) => [iso, region]),
  ),
);

export function geographicRegionForRow(row) {
  return row.derivedKind ? undefined : byCountry.get(row.iso);
}

export function regionOptions(rows) {
  const broad = [
    ...new Map(
      rows
        .filter((row) => row.region?.id)
        .map((row) => [row.region.id, row.region]),
    ).values(),
  ];
  const available = new Set(
    rows.filter((row) => !row.derivedKind).map((row) => row.iso),
  );
  const detailed = GEOGRAPHIC_REGIONS.filter((region) =>
    region.members.some((iso) => available.has(iso)),
  );
  return {
    broad: broad.sort((a, b) => a.name.localeCompare(b.name)),
    detailed: detailed.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function matchesRegions(row, selectedIds) {
  if (!selectedIds.length) return true;
  return (
    selectedIds.includes(row.region?.id) ||
    (row.derivedKind === "region" && selectedIds.includes(row.iso)) ||
    selectedIds.includes(geographicRegionForRow(row)?.id)
  );
}
