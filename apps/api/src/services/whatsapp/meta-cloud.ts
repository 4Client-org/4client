import { decryptSecret } from '../../lib/crypto.js';

const META_API_BASE = 'https://graph.facebook.com/v22.0';

export class MetaCloudProvider {
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
  ) {}

  async sendText(to: string, text: string): Promise<{ messageId: string }> {
    const res = await fetch(`${META_API_BASE}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Meta API sendText failed (${res.status}): ${JSON.stringify(err)}`);
    }

    const data = await res.json() as { messages: [{ id: string }] };
    return { messageId: data.messages[0].id };
  }

  // Step 1 of receiving an inbound photo: Meta's webhook only gives us a media id,
  // not a downloadable URL - this resolves it to a short-lived (~5min) authenticated
  // URL. Step 2 (downloadMedia below) fetches the actual bytes from that URL before
  // it expires.
  async getMediaUrl(mediaId: string): Promise<{ url: string; mimeType: string }> {
    const res = await fetch(`${META_API_BASE}/${mediaId}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Meta API getMediaUrl failed (${res.status}): ${JSON.stringify(err)}`);
    }
    const data = await res.json() as { url: string; mime_type: string };
    return { url: data.url, mimeType: data.mime_type };
  }

  async downloadMedia(url: string): Promise<Buffer> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } });
    if (!res.ok) throw new Error(`Meta API downloadMedia failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  // Outbound photo, step 1: upload the raw bytes directly to Meta (never a public
  // URL of ours) to get back a media id, then step 2 (sendImage) references that id
  // in the actual message - this is what keeps the photo from ever being reachable
  // via a public link anywhere in the path.
  async uploadMedia(buffer: Buffer, mimeType: string): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([buffer], { type: mimeType }));
    const res = await fetch(`${META_API_BASE}/${this.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Meta API uploadMedia failed (${res.status}): ${JSON.stringify(err)}`);
    }
    const data = await res.json() as { id: string };
    return data.id;
  }

  async sendImage(to: string, mediaId: string, caption?: string): Promise<{ messageId: string }> {
    const res = await fetch(`${META_API_BASE}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'image',
        image: { id: mediaId, ...(caption ? { caption } : {}) },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Meta API sendImage failed (${res.status}): ${JSON.stringify(err)}`);
    }
    const data = await res.json() as { messages: [{ id: string }] };
    return { messageId: data.messages[0].id };
  }

  async markAsRead(messageId: string): Promise<void> {
    await fetch(`${META_API_BASE}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    }).catch(() => {}); // non-critical, best effort
  }

  static fromOrg(org: { wpp_meta_phone_id: string | null; wpp_meta_token: string | null }): MetaCloudProvider | null {
    if (!org.wpp_meta_phone_id || !org.wpp_meta_token) return null;
    const token = decryptSecret(org.wpp_meta_token);
    if (!token) return null;
    return new MetaCloudProvider(org.wpp_meta_phone_id, token);
  }
}
