import { sqliteTable, text, integer, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"),
  disabled: integer("disabled").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, () => [check("users_role", sql.raw("(id=1 AND role='superadmin') OR (id>1 AND role='user')"))]);
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
  authorId: integer("author_id").references(() => users.id),
}, (t) => [index("posts_status_date").on(t.status, t.createdAt), index("posts_author_date").on(t.authorId, t.createdAt)]);
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  done: integer("done").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  userId: integer("user_id").references(() => users.id),
}, (t) => [index("tasks_user_date").on(t.userId, t.createdAt)]);
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
  userId: integer("user_id").references(() => users.id),
}, (t) => [index("sessions_user").on(t.userId)]);
export const loginLimits = sqliteTable("login_limits", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  attempts: integer("attempts").notNull(),
});
