import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    /*
     * The screenshots are the product, and they are dense UI shown small. 88
     * rather than the default 75 because at 75 the lime-on-true-black type in
     * them picks up visible ringing, which is the one artefact this palette
     * makes obvious. Next 16 requires every quality the app asks for to be
     * listed here rather than accepting it per call site.
     */
    qualities: [75, 88],
  },
};

export default nextConfig;
