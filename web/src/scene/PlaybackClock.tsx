import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

type Props = {
  clockRef: { current: number }
  playing: boolean
  rate: number
  duration: number
  onTick: (seconds: number) => void
  onEnd: () => void
}

export default function PlaybackClock({ clockRef, playing, rate, duration, onTick, onEnd }: Props) {
  const sinceTick = useRef(0)
  useFrame((_, delta) => {
    if (!playing) return
    clockRef.current = Math.min(duration, clockRef.current + Math.min(delta, 0.2) * rate)
    sinceTick.current += delta
    if (sinceTick.current >= 0.25 || clockRef.current >= duration) {
      onTick(clockRef.current)
      sinceTick.current = 0
    }
    if (clockRef.current >= duration) onEnd()
  })
  return null
}
