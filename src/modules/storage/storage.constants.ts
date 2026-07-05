export enum StorageFolder {
  HOTELS = 'hotels',
  ROOMS = 'rooms',
  GUEST_DOCUMENTS = 'guest-documents',
  GUEST_PHOTOS = 'guest-photos',
  AVATARS = 'avatars',
  INVOICES = 'invoices',
}

export interface UploadedFileResult {
  key: string;
  url: string;
  bucket: string;
  mimeType: string;
  size: number;
  originalName: string;
}

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
] as const;

export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
