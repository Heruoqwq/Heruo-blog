declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ADMIN_PASSWORD_HASH?: string;
    BLOG_ALLOWED_ORIGIN?: string;
  }
}
