import { getCollection } from 'astro:content';
import { domainLabel } from '../config/domains';

export const formatDate = (value: string | Date) => new Date(value).toLocaleDateString('zh-CN', {
	year: 'numeric', month: 'long', day: 'numeric',
});

export const getPublishedComputerPosts = async () => {
	const posts = await getCollection('computer', ({ data }) => !data.draft);
	return posts.sort((a, b) => new Date(b.data.updated ?? b.data.date).valueOf() - new Date(a.data.updated ?? a.data.date).valueOf());
};

export const getPublishedReadingPosts = async () => {
	const posts = await getCollection('reading', ({ data }) => !data.draft);
	return posts.sort((a, b) => new Date(b.data.updated ?? b.data.date).valueOf() - new Date(a.data.updated ?? a.data.date).valueOf());
};

export const postPath = (post: { id: string }) => post.id.replace(/\.(?:md|mdx)$/, '');

export const postHref = (post: any, collection?: 'computer' | 'reading') => {
	const target = collection ?? post.collection;
	return target === 'reading' ? `/reading/${postPath(post)}` : `/knowledge/${postPath(post)}`;
};

export const statusLabel = (status: string) => status === 'settled' ? '已沉淀' : '持续完善';
export { domainLabel };
