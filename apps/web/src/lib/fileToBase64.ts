export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // matches inbox.ts's MAX_IMAGE_BYTES
export const CHAT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Strips the "data:image/png;base64," prefix FileReader's readAsDataURL adds -
// the API wants the raw base64 payload, same shape files.ts's invoice upload
// already expects.
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
