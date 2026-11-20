/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg"],
  allowedDevOrigins: ["192.168.0.83"],
};
export default nextConfig;
