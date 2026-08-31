export interface ShortlistTopic {
  topic_id: string
  title: string
}

interface SubmissionFailure {
  topic: ShortlistTopic
  error: string
}

export async function submitShortlistApplications(
  topics: ShortlistTopic[],
  submit: (topicId: string, priority: number) => Promise<unknown>
) {
  const submittedTopicIds: string[] = []
  const failed: SubmissionFailure[] = []

  for (let index = 0; index < topics.length; index++) {
    const topic = topics[index]
    try {
      await submit(topic.topic_id, index + 1)
      submittedTopicIds.push(topic.topic_id)
    } catch (err: any) {
      failed.push({
        topic,
        error: err?.response?.data?.message || err?.message || '提交失败'
      })
    }
  }

  return { submittedTopicIds, failed }
}
