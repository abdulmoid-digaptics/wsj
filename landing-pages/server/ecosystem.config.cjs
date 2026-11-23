/* PM2 process file. On the server:  cd landing-pages/server && pm2 start ecosystem.config.cjs && pm2 save */
module.exports = {
  apps: [
    {
      name: 'wj-landing-pages',
      script: 'server.mjs',
      cwd: __dirname,
      exec_mode: 'fork',      // single instance: the order log and promo holds live in this process
      instances: 1,
      autorestart: true,
      max_memory_restart: '200M',
      kill_timeout: 9000,
      env: { NODE_ENV: 'production' },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      time: true
    }
  ]
};
