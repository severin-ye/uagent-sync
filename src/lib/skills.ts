export const KNOWN_SKILL_SOURCES: Record<string, string> = {
  "gstack": "garrytan/gstack@gstack",
  "docx": "anthropics/skills@docx",
  "pdf": "anthropics/skills@pdf",
  "pptx": "anthropics/skills@pptx",
  "frontend-design": "anthropics/skills@frontend-design",
  "ui-ux-pro-max": "nexu-io/open-design@ui-ux-pro-max",
  "workflow-skill-creator": "anthropics/skills@workflow-skill-creator",
  "literature-search-arxiv": "anthropics/skills@literature-search-arxiv",
  "literature-search-biorxiv": "anthropics/skills@literature-search-biorxiv",
  "literature-search-europepmc": "anthropics/skills@literature-search-europepmc",
  "literature-search-openalex": "anthropics/skills@literature-search-openalex",
  "uv": "anthropics/skills@uv",
};

export const SKILL_PACKAGES: Array<{ source: string; skills: string[] }> = [
  { source: "garrytan/gstack@gstack", skills: ["gstack"] },
  { source: "anthropics/skills@frontend-design", skills: ["frontend-design"] },
  { source: "nexu-io/open-design@ui-ux-pro-max", skills: ["ui-ux-pro-max"] },
  { source: "anthropics/skills@docx", skills: ["docx"] },
  { source: "anthropics/skills@pdf", skills: ["pdf"] },
  { source: "anthropics/skills@pptx", skills: ["pptx"] },
  { source: "google-deepmind/science-skills", skills: [
    "alphafold-database-fetch-and-analyze", "alphagenome-single-variant-analysis", "chembl-database", "clinical-trials-database",
    "clinvar-database", "dbsnp-database", "embl-ebi-ols", "encode-ccres-database", "ensembl-database", "foldseek-structural-search",
    "gnomad-database", "gtex-database", "human-protein-atlas-database", "interpro-database", "jaspar-database", "ncbi-sequence-fetch",
    "openfda-database", "opentargets-database", "pdb-database", "protein-sequence-msa", "protein-sequence-similarity-search",
    "pubchem-database", "pubmed-database", "pymol", "quickgo-database", "reactome-database", "scienceskillscommon",
    "string-database", "ucsc-conservation-and-tfbs", "unibind-database", "uniprot-database",
  ]},
];

export function resolveSkillSources(installedSkills: string[]): string[] {
  const sources = new Set<string>();
  for (const skill of installedSkills) { if (KNOWN_SKILL_SOURCES[skill]) sources.add(KNOWN_SKILL_SOURCES[skill]); }
  for (const pkg of SKILL_PACKAGES) {
    const installed = pkg.skills.filter(s => installedSkills.includes(s));
    if (installed.length > 0 && installed.length >= pkg.skills.length * 0.3) sources.add(pkg.source);
  }
  return [...sources];
}
