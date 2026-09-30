// Заготовка облачного хранилища (Amazon S3, Cloudflare R2, Yandex Object Storage, DigitalOcean Spaces —
// все совместимы с S3). Интерфейс такой же, как у local.js: save(key, buffer, mime) / remove(key) / urlFor(key).
//
// Как включить позже:
//   1) npm install @aws-sdk/client-s3
//   2) в .env: STORAGE_DRIVER=s3, S3_BUCKET, S3_REGION, S3_ENDPOINT (для R2/Yandex), S3_PUBLIC_URL,
//      AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
//   3) раскомментировать код ниже.
export function createS3Storage(opts) {
  const notReady = () => { throw new Error('S3-хранилище ещё не подключено: см. комментарий в src/storage/s3.js'); };
  return {
    driver: 's3',
    save: notReady,
    remove: notReady,
    urlFor: (key) => `${(opts.publicUrl || '').replace(/\/$/, '')}/${key}`,
  };
  /*
  import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
  const s3 = new S3Client({ region: opts.region, endpoint: opts.endpoint });
  return {
    driver: 's3',
    async save(key, buffer, mime) {
      await s3.send(new PutObjectCommand({ Bucket: opts.bucket, Key: key, Body: buffer, ContentType: mime }));
      return { key, url: `${opts.publicUrl}/${key}` };
    },
    async remove(key) { await s3.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: key })); },
    urlFor: (key) => `${opts.publicUrl}/${key}`,
  };
  */
}
