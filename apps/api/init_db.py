from db import engine
from models import Base, DrugLabel, DrugLabelChunk

def main():
    Base.metadata.create_all(bind=engine)
    print("Tables created successfully")

if __name__ == "__main__":
    main()
