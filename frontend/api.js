export async function api(path, { timeoutMs = 15000, ...options } = {}) {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutController.signal]) : timeoutController.signal;
  try {
    const response = await fetch(path, { ...options, signal, headers: { 'Content-Type': 'application/json', ...options.headers } });
    let data;
    try { data = await response.json(); }
    catch (error) {
      if (signal.aborted) throw error;
      throw new Error('The server returned an unreadable response. Please try again.');
    }
    if (!response.ok) throw new Error(data?.error || 'The request could not be completed.');
    return data;
  } catch (error) {
    if (timeoutController.signal.aborted && !options.signal?.aborted) {
      const message = options.method && options.method !== 'GET'
        ? 'The request timed out. Its outcome is unknown; retry with the same event IDs.'
        : 'The request timed out. Refresh to try again.';
      throw new Error(message);
    }
    throw error;
  } finally { clearTimeout(timeout); }
}
