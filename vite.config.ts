import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode})=>{
 const env=loadEnv(mode,process.cwd(),'PORT');
 return {root:'web',plugins:[react()],server:{proxy:{'/api':{target:`http://127.0.0.1:${process.env.PORT||env.PORT||3000}`,changeOrigin:false}}},build:{outDir:'../web-dist',emptyOutDir:true,sourcemap:false,rollupOptions:{output:{manualChunks:{charts:['recharts']}}}}};
});
