import { defineCollection, z } from 'astro:content';

const blogCollection = defineCollection({
	schema: z.object({
		title: z.string(),
		date: z.string().or(z.date()),
		description: z.string().optional(),
		subcategory: z.string().optional(), // 新增字段
		term: z.string().optional(), // 新增三级分类字段
		order: z.number().optional().default(100), // 用于手动排序
	}),
});

export const collections = {
	'computer': blogCollection,
	'reading': blogCollection,
	'life': blogCollection,
};
