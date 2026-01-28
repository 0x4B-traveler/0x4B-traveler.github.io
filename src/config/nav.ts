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

