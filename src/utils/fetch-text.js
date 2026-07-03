export const fetchText = async url => {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'pwa-check/0.1'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.text();
};
