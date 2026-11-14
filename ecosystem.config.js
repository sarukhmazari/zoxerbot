module.exports = {
  apps: [
    {
      name: "zoxerbot",
      script: "main.js",
      node_args: "--max-old-space-size=1536",
      max_memory_restart: "1300M",
      restart_delay: 5000,
      exp_backoff_restart_delay: 2000,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
