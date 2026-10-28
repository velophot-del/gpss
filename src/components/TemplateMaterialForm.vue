<template>
  <div>
    <el-alert :title="`模板：${template.title} · ${template.version}`" description="固定内容由管理员统一制定；此材料保存后绑定本版本，后续模板更新不会替换它。" type="info" :closable="false" class="template-notice" />
    <el-form label-position="top">
      <el-form-item v-for="field in studentFields" :key="field.key" :label="field.label" :required="field.required">
        <el-input :model-value="modelValue[field.key] || ''" type="textarea" :rows="field.key === 'title' ? 2 : 5" :maxlength="field.key === 'title' ? 200 : 50000" show-word-limit :disabled="readonly" @update:model-value="update(field.key, $event)" />
      </el-form-item>
    </el-form>
    <el-collapse>
      <el-collapse-item title="查看管理员固定内容及阶段工作计划" name="fixed">
        <div v-for="field in fixedFields" :key="field.id" class="fixed-content">{{ field.value ?? field.original }}</div>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MaterialTemplate } from '../types'
const props = defineProps<{ template: MaterialTemplate; modelValue: Record<string, string>; readonly?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: Record<string, string>): void }>()
const studentFields = computed(() => props.template.profile.fields.filter((f, i, all) => f.source === 'student' && all.findIndex(x => x.source === 'student' && x.key === f.key) === i)
  .map(f => ({ ...f, required: props.template.profile.fields.some(x => x.source === 'student' && x.key === f.key && x.required) })))
const fixedFields = computed(() => props.template.profile.fields.filter(f => f.source === 'fixed' && (f.value ?? f.original).trim()))
function update(key: string, value: string) { emit('update:modelValue', { ...props.modelValue, [key]: value }) }
</script>

<style scoped>
.template-notice { margin-bottom: 18px; }
.fixed-content { white-space: pre-wrap; line-height: 1.8; margin: 8px 0; overflow-wrap: anywhere; }
</style>
