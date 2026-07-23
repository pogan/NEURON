module.exports = {
  apps: [
    {
      name: 'neuron',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3000,
      },
      error_file: 'logs/neuron-error.log',
      out_file: 'logs/neuron-out.log',
      time: true,
    },
  ],
};
