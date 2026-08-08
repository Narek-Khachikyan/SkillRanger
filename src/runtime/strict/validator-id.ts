export const validatorIdPattern = /^([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)$/;

export const parseValidatorId = (id: string): { owner: string; name: string } | undefined => {
  const match = validatorIdPattern.exec(id);
  if (!match) return undefined;
  return { owner: match[1], name: match[2] };
};
