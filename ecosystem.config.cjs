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
      // HOST i PORT zostawiamy `.env` — pm2 ustawiłby je w process.env,
      // a dotenv nie nadpisuje istniejących zmiennych (kolizje portów na VPS).
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/neuron-error.log',
      out_file: 'logs/neuron-out.log',
      time: true,
    },
  ],
};
