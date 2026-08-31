import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const updateSchema = z.object({
	date: z.string().or(z.date()),
	summary: z.string(),
});

const knowledgeSchema = z.object({
	title: z.string(),
	description: z.string(),
	date: z.string().or(z.date()),
	updated: z.string().or(z.date()).optional(),
	domain: z.string(),
	tags: z.array(z.string()).default([]),
	status: z.enum(['growing', 'settled']).default('growing'),
	draft: z.boolean().default(false),
	updates: z.array(updateSchema).default([]),
	related: z.array(z.string()).default([]),
	order: z.number().default(100),
	// 兼容迁移前的字段；页面不再依赖固定三级目录。
	subcategory: z.string().optional(),
	term: z.string().optional(),
});

export const collections = {
	computer: defineCollection({
		loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/computer' }),
		schema: knowledgeSchema,
	}),
	reading: defineCollection({
		loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/reading' }),
		schema: knowledgeSchema,
	}),
};
