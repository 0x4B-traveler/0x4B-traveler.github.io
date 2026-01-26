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
  'computer/frontend/react': [
    { title: 'React Hooks 详解', link: '/computer/frontend/react/react-hooks' },
  ],
  'computer/backend': [
    { title: '后端路线图', link: '/computer/backend/roadmap' }, // 示例链接
  ],
  'reading/literature': [
    { title: '百年孤独', link: '/reading/literature/100-years-of-solitude' },
  ],
  // 默认回退：如果没有配置，代码逻辑应自动获取该分类下文章
};
