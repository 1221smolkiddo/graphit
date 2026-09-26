from util import helper as add, Base
import external_library

class Worker(Base):
    def helper(self, value):
        return add(value)

    def run(self, value):
        return self.helper(value)

def entry():
    def nested():
        return add(1)
    return nested()

def duplicate():
    return 1
