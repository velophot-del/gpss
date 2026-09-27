import { createHmac } from 'crypto'
import { resolveJwtSecret } from './policies.js'

export function getTeacherGroupKey(teacherId: string | number | null | undefined): string | null {
  if (teacherId == null || teacherId === '') return null
  return createHmac('sha256', resolveJwtSecret())
    .update(String(teacherId))
    .digest('hex')
}

export function toStudentTopicView<T extends Record<string, any>>(topic: T, teacherId?: string | number | null) {
  const {
    teacher_id: rawTeacherId,
    teacherId: _teacherId,
    teacher_name: _teacherName,
    teacherName: _teacherNameCamel,
    teacher_title: _teacherTitle,
    teacherTitle: _teacherTitleCamel,
    teacher_department: _teacherDepartment,
    teacherDepartment: _teacherDepartmentCamel,
    department: _department,
    teacher_email: _teacherEmail,
    teacherEmail: _teacherEmailCamel,
    teacher_phone: _teacherPhone,
    teacherPhone: _teacherPhoneCamel,
    teacher_avatar: _teacherAvatar,
    teacherAvatar: _teacherAvatarCamel,
    ...safeTopic
  } = topic
  return { ...safeTopic, teacherGroupKey: getTeacherGroupKey(teacherId ?? rawTeacherId) }
}
