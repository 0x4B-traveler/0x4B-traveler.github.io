export const navConfig = {
  computer: {
    label: '计算机',
    subcategories: {
      frontend: { 
        label: '计算机基础',
        terms: {
          basic: '基础知识',
          react: 'React',
          vue: 'Vue',
          performance: '性能优化'
        }
      },
      backend: { 
        label: '后端架构',
        terms: {
          database: '数据库',
          microservices: '微服务'
        }
      },
      ai: { 
        label: '人工智能',
        terms: {
          llm: '大模型',
          cv: '计算机视觉'
        }
      }
    }
  },
  reading: {
    label: '读书',
    subcategories: {
      literature: { 
        label: '文学',
        terms: {
          novel: '小说',
          essay: '散文'
        }
      },
      history: { label: '历史' },
      tech: { label: '技术类' }
    }
  },
  life: {
    label: '生活',
    subcategories: {
      journal: { label: '随笔' },
      travel: { label: '旅行' }
    }
  }
};

// 侧边栏手动配置 (模拟“不是真的目录，而是手动链接”)
// 键格式: `${category}/${subcategory}`
export interface SidebarItem {
  title: string;
  link: string;
}

export interface SidebarConfig {
  [key: string]: SidebarItem[];
}

export const sidebarConfig: SidebarConfig = {
  'computer/frontend': [
    { title: 'Astro 基础', link: '/computer/frontend/basic/astro-learning' },
  ],
  'computer/frontend/basic': [
    { title: '计算机基础知识入门', link: '/computer/frontend/basic/introduction' },
  ],
  'computer/frontend/react': [
    { title: 'React 框架学习指南', link: '/computer/frontend/react/introduction' },
    { title: 'React Hooks 详解', link: '/computer/frontend/react/react-hooks' },
  ],
  'computer/frontend/vue': [
    { title: 'Vue 框架学习指南', link: '/computer/frontend/vue/introduction' },
  ],
  'computer/frontend/performance': [
    { title: '前端性能优化指南', link: '/computer/frontend/performance/introduction' },
  ],
  'computer/backend': [
    { title: '后端路线图', link: '/computer/backend/roadmap' },
  ],
  'computer/backend/database': [
    { title: '数据库系统学习', link: '/computer/backend/database/introduction' },
  ],
  'computer/backend/microservices': [
    { title: '微服务架构设计', link: '/computer/backend/microservices/introduction' },
  ],
  'computer/ai/llm': [
    { title: '大模型（LLM）技术探索', link: '/computer/ai/llm/introduction' },
  ],
  'computer/ai/cv': [
    { title: '计算机视觉（CV）技术', link: '/computer/ai/cv/introduction' },
  ],
  'reading/literature': [
    { title: '百年孤独', link: '/reading/literature/100-years-of-solitude' },
  ],
  'reading/literature/novel': [
    { title: '小说阅读笔记', link: '/reading/literature/novel/introduction' },
  ],
  'reading/literature/essay': [
    { title: '散文随笔集', link: '/reading/literature/essay/introduction' },
  ],
  // 默认回退：如果没有配置，代码逻辑应自动获取该分类下文章
};
