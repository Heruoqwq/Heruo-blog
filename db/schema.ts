import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  excerpt: text("excerpt").notNull().default(""),
  category: text("category").notNull().default("随笔"),
  tags: text("tags").notNull().default("[]"),
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [index("posts_status_date").on(t.status, t.createdAt)]);
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  done: integer("done").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
});
export const loginLimits = sqliteTable("login_limits", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  attempts: integer("attempts").notNull(),
});
