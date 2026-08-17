// The single canonical token normalization and the skill-index lookup shared by
// every Routing module and evaluation adapter. Earlier modules each defined a
// private copy; this is the consolidation point so a canonical id can never be
// normalized differently (or a skill index built differently) between modules.
export const canonical = (value: string) => value.normalize("NFKC").trim().toLowerCase();

export const skillIndexById = <TSkill extends { id: string }>(skills: TSkill[]) =>
  new Map(skills.map((skill) => [canonical(skill.id), skill]));