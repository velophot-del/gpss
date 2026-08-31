export function validateInitialAdminPassword(password: string | undefined) {
  if (!password) {
    throw new Error('管理员初始密码不能为空')
  }
  if (password.length < 12) {
    throw new Error('管理员初始密码至少 12 位')
  }
  return password
}
