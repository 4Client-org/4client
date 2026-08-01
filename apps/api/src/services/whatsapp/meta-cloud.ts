import { decryptSecret } from '../../lib/crypto.js';

const META_API_BASE = 'https://graph.facebook.com/v22.0';

// WhatsApp usernames / Business-Scoped User ID (BSUID) rollout, June 2026 - a
// contact with a username enabled can have no reachable phone number at all,
// only a BSUID (format "CC.<up to 128 alphanumeric chars>", e.g.
// "CO.919210307886008" - see webhook.ts's own notes on where this comes from
// and Ticket.phone in schema.prisma, which now stores either kind
// interchangeably). Meta's send API takes the SAME message body either way,
// just under a different key: `to` for a real phone number, `recipient` for
// a BSUID - this is the one place that distinction actually matters.
function toOrRecipient(identifier: string): { to: string } | { recipient: string } {
  return /^[A-Za-z]{2}\.[A-Za-z0-9]+$/.test(identifier) ? { recipient: identifier } : { to: identifier };
}

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
        ...toOrRecipient(to),
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
        ...toOrRecipient(to),
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

  // WhatsApp's audio message type has no caption field at all (unlike image/
  // video/document) - Meta's API silently ignores one if sent, so there's
  // nothing to accept here.
  async sendAudio(to: string, mediaId: string): Promise<{ messageId: string }> {
    const res = await fetch(`${META_API_BASE}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        ...toOrRecipient(to),
        type: 'audio',
        audio: { id: mediaId },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Meta API sendAudio failed (${res.status}): ${JSON.stringify(err)}`);
    }
    const data = await res.json() as { messages: [{ id: string }] };
    return { messageId: data.messages[0].id };
  }

  async sendVideo(to: string, mediaId: string, caption?: string): Promise<{ messageId: string }> {
    const res = await fetch(`${META_API_BASE}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        ...toOrRecipient(to),
        type: 'video',
        video: { id: mediaId, ...(caption ? { caption } : {}) },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Meta API sendVideo failed (${res.status}): ${JSON.stringify(err)}`);
    }
    const data = await res.json() as { messages: [{ id: string }] };
    return { messageId: data.messages[0].id };
  }

  // `filename` is what shows up as the file's name on the client's phone - without
  // it WhatsApp falls back to something generic/blank, since our own storage
  // token (the only "name" Meta ever sees otherwise) is a meaningless hex string.
  async sendDocument(to: string, mediaId: string, filename: string, caption?: string): Promise<{ messageId: string }> {
    const res = await fetch(`${META_API_BASE}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        ...toOrRecipient(to),
        type: 'document',
        document: { id: mediaId, filename, ...(caption ? { caption } : {}) },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Meta API sendDocument failed (${res.status}): ${JSON.stringify(err)}`);
    }
    const data = await res.json() as { messages: [{ id: string }] };
    return { messageId: data.messages[0].id };
  }

  // The one outbound media type with no uploadMedia step at all - a location is
  // just coordinates in the message body itself, nothing to upload to Meta first.
  async sendLocation(to: string, latitude: number, longitude: number, name?: string, address?: string): Promise<{ messageId: string }> {
    const res = await fetch(`${META_API_BASE}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        ...toOrRecipient(to),
        type: 'location',
        location: { latitude, longitude, ...(name ? { name } : {}), ...(address ? { address } : {}) },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Meta API sendLocation failed (${res.status}): ${JSON.stringify(err)}`);
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
