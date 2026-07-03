export const resolveUrl = (baseUrl, possiblyRelativeUrl) => {
  return new URL(possiblyRelativeUrl, baseUrl).href;
};

export const normalizeUrl = inputUrl => {
  return inputUrl.startsWith('http')
    ? inputUrl
    : `https://${inputUrl}`;
};
