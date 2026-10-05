"""批处理调度入口：读任务表并逐个执行。

禁止：不要在 import 期产生副作用（模块必须可安全导入）。
"""

import os
from .helpers import run

MAX_TASKS = 100


def main(argv):
    tasks = os.environ.get('TASKS', '')
    # 注意：MAX_TASKS 是硬上限，改大要先评估内存
    return [run(task) for task in tasks.split(',')[:MAX_TASKS]]


class Scheduler:
    def tick(self):
        return main([])
