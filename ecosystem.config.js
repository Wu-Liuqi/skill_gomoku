module.exports = {
  apps: [{
    name: 'skills-gomoku',
    script: './backend/server.js',
    cwd: '/opt/wuziqi/skill_gomoku',
    instances: 2, // 利用2个CPU核心
    exec_mode: 'cluster',
    autorestart: true,
    watch: false,
    max_memory_restart: '800M', // 单实例最大内存
    min_uptime: '10s',
    max_restarts: 10,
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    // 性能监控
    pmx: true,
    // 进程间负载均衡
    instance_var: 'INSTANCE_ID'
  }]
};