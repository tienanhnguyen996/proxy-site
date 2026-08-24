const SECRET_KEY = process.env.AUTH_SECRET || 'aetherread-secret-32-chars-long-key-string';

// Generate an HMAC SHA-256 signature
async function sign(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  
  // Convert signature buffer to hex
  return Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Creates a signed session token.
 * Output format: username:expiresAt:signature
 */
export async function createSessionToken(username: string): Promise<string> {
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const payload = `${username}:${expiresAt}`;
  const signature = await sign(payload, SECRET_KEY);
  return `${payload}:${signature}`;
}

/**
 * Verifies a signed session token.
 * Returns true if signature is valid and username matches the expected one.
 */
export async function verifySessionToken(token: string): Promise<boolean> {
  if (!token) return false;
  
  try {
    const parts = token.split(':');
    if (parts.length !== 3) return false;

    const [username, expiresAtStr, signature] = parts;
    const expiresAt = parseInt(expiresAtStr, 10);

    // Check if expired
    if (isNaN(expiresAt) || expiresAt < Date.now()) {
      return false;
    }

    // Must match the hardcoded username
    if (username !== 'anhnt314') {
      return false;
    }

    const payload = `${username}:${expiresAtStr}`;
    const expectedSignature = await sign(payload, SECRET_KEY);

    // Verify signature
    return signature === expectedSignature;
  } catch (err) {
    console.error('Session token verification failed', err);
    return false;
  }
}
