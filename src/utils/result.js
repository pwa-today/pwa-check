export const result = (status, message, code) => {
  const entry = { status, message };

  if (code !== undefined) {
    entry.code = code;
  }

  return entry;
};
