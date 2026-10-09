export async function exchangeChallenge(client, topics, body, timeoutMs = 15000) {
  let timer;
  let listener;
  const response = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('No matching response arrived before the timeout. Check the backend MQTT connection.')), timeoutMs);
    listener = (topic, payload) => {
      if (topic !== topics.response) return;
      try {
        const result = JSON.parse(payload.toString());
        if (result.challenge_id === body.challenge_id) resolve(result);
      } catch { /* Ignore unrelated malformed responses. */ }
    };
    client.on('message', listener);
  });
  try {
    // Observe both promises immediately: a missing PUBACK must not leave the
    // response timeout unhandled while publishAsync is still pending.
    const [, result] = await Promise.all([
      client.publishAsync(topics.challenge, JSON.stringify(body), { qos: 1, retain: false }), response,
    ]);
    return result;
  } finally {
    clearTimeout(timer);
    client.off('message', listener);
  }
}
