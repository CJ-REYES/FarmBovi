export type CattleSex = 'Hembra' | 'Macho'

export interface Cattle {
  id: number
  earTag: string
  name: string
  breed: string
  sex: CattleSex
  birthDate: string | null
  createdAt: string
}

export interface CattleInput {
  earTag: string
  name: string
  breed: string
  sex: CattleSex
  birthDate: string | null
}
