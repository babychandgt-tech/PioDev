import { motion } from 'framer-motion';
import { sceneTransitions } from '@/lib/video/animations';
import { Terminal } from 'lucide-react';

export default function Scene1() {
  const tagline = "AI buat ngoding yang beneran ngerti".split(" ");

  return (
    <motion.div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center"
      {...sceneTransitions.scaleFade}
      exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div 
        className="flex flex-col items-center"
        initial={{ y: 50 }}
        animate={{ y: -40 }}
        transition={{ duration: 1, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="flex items-center gap-[2vw]">
          <motion.div 
            className="w-[8vw] h-[8vw] bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center shadow-2xl shadow-primary/30"
            initial={{ scale: 0, rotate: -45 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.2 }}
          >
            <Terminal className="w-[4vw] h-[4vw] text-white" />
          </motion.div>
          <motion.h1 
            className="text-[8vw] font-display font-bold tracking-tight text-white"
            initial={{ opacity: 0, x: -40, filter: 'blur(10px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.8, delay: 0.4 }}
          >
            PioDev
          </motion.h1>
        </div>

        <motion.div 
          className="mt-[4vh] flex flex-wrap justify-center gap-[1vw] max-w-[80vw]"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: { staggerChildren: 0.15, delayChildren: 1 }
            }
          } as any}
        >
          {tagline.map((word, i) => (
            <motion.span
              key={i}
              className={`text-[3.5vw] font-medium ${i >= 3 ? 'bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent' : 'text-text-secondary'}`}
              variants={{
                hidden: { opacity: 0, y: 20, filter: 'blur(10px)' },
                visible: { opacity: 1, y: 0, filter: 'blur(0px)' }
              }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              {word}
            </motion.span>
          ))}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
