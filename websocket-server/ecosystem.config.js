export default {
  apps: [{
    name: 'nanobrowser-websocket-server',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'development',
      PORT: 8080
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 8080
    },
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};