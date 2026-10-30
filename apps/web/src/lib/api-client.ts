import axios from "axios"

export const api = axios.create({
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
  },
})

export interface ApiErrorResponse {
  code: number
  msg: string
  path?: string
  timestamp?: string
}
