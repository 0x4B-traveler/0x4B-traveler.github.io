export const domains = {
	database: { label: '数据库', description: '数据模型、存储引擎、事务与性能优化', mark: 'DB' },
	'cloud-native': { label: '云原生', description: '微服务、容器、编排与分布式系统', mark: 'CN' },
	'programming-language': { label: '编程语言', description: '语言特性、框架与工程实践', mark: 'PL' },
	algorithm: { label: '算法', description: '数据结构、解题方法与复杂度分析', mark: 'AL' },
	ai: { label: '人工智能', description: '大模型、计算机视觉与智能应用', mark: 'AI' },
	'computer-science': { label: '计算机基础', description: '体系结构、网络与操作系统基础', mark: 'CS' },
	reading: { label: '读书', description: '文学阅读、观念与长期思考', mark: 'BK' },
} as const;

export type DomainKey = keyof typeof domains;
export const domainLabel = (key: string) => domains[key as DomainKey]?.label ?? key;
