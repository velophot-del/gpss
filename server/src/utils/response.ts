import { Response } from 'express'

export interface ApiResponse<T = any> {
  code: number
  message: string
  data?: T
}

export function success<T = any>(res: Response, data?: T, message = '操作成功', code = 200) {
  return res.json({ code, message, data })
}

export function error(res: Response, message = '操作失败', code = 400, details?: any) {
  return res.status(code).json({ code, message, ...(details && { details }) })
}

export function paginated(res: Response, list: any[], total: number, page: number, pageSize: number, message = '查询成功') {
  return res.json({
    code: 200,
    message,
    data: {
      list,
      pagination: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
    }
  })
}
