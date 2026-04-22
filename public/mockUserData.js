import {
    LevelQuest, Level, Vocabulary, Assessment,
    Introduction, RegionQuestHook, Region,
    EncounterReward, Encounter, Reward,
    NarrativeData, NarrativeOutput, NarrativeStructure,
    User
} from './data_class.js';

// ----------------- Mock User Instance -----------------
const mockUser = new User({
    id: "user_00123",
    name: "Alex", 
    email: "Alex@example.com",
    
    currentLevel: 2,
    levelsLeft: 1,
    completedLevelsNames: ["Level 1: Introduction to Cardinality"],
    
    levelProgress: [
        new Level(
            "Level 1: Introduction to Cardinality",
            "Learn the basics of cardinality and its importance in database design.",
            [
                new LevelQuest(
                    "Quest 1.1: Understand Cardinality",
                    "Explain the concept of cardinality and its types.",
                    ["cardinality", "one-to-one", "one-to-many", "many-to-many"],
                    ["define cardinality", "explain types of cardinality"],
                    [],
                    true
                ),
                new LevelQuest(
                    "Quest 1.2: Identify Cardinality Types",
                    "Identify the types of cardinality in a given scenario.",
                    ["one-to-one", "one-to-many", "many-to-many"],
                    ["identify cardinality types", "explain examples"],
                    ["Quest 1.1"],
                    true
                )
            ],
            true
        ),
        new Level(
            "Level 2: Cardinality in ER Diagrams",
            "Learn how to represent cardinality in ER diagrams.",
            [
                new LevelQuest(
                    "Quest 2.1: Draw ER Diagrams with Cardinality",
                    "Draw ER diagrams representing one-to-one, one-to-many, and many-to-many relationships.",
                    ["ER diagrams", "cardinality symbols"],
                    ["draw ER diagrams with cardinality", "explain symbols"],
                    [],
                    true
                ),
                new LevelQuest(
                    "Quest 2.2: Interpret ER Diagrams with Cardinality",
                    "Interpret ER diagrams representing one-to-one, one-to-many, and many-to-many relationships.",
                    ["ER diagrams", "cardinality symbols"],
                    ["interpret ER diagrams with cardinality", "explain relationships"],
                    ["Quest 2.1"],
                    false
                )
            ],
            false
        ),
        new Level(
            "Level 3: Recursive Relationships",
            "Learn about recursive relationships and their representation in ER diagrams.",
            [
                new LevelQuest(
                    "Quest 3.1: Understand Recursive Relationships",
                    "Explain the concept of recursive relationships and their types.",
                    ["recursive relationships", "one-to-many"],
                    ["define recursive relationships", "explain types"],
                    [],
                    false
                ),
                new LevelQuest(
                    "Quest 3.2: Draw ER Diagrams with Recursive Relationships",
                    "Draw ER diagrams representing recursive relationships.",
                    ["ER diagrams", "recursive relationships"],
                    ["draw ER diagrams with recursive relationships", "explain roles"],
                    ["Quest 3.1"],
                    false
                )
            ],
            false
        )
    ],
    
    currentQuest: "Quest 2.2: Interpret ER Diagrams with Cardinality",
    
    vocabularyProgress: [
        new Vocabulary(
            "Cardinality", 
            "Concept", 
            "A constraint on a relationship specifying the number of entity instances that a specific entity may be related to via the relationship.", 
            true
        ),
        new Vocabulary(
            "One-to-One", 
            "Type of Cardinality", 
            "A type of cardinality where one instance of an entity type is related to at most one instance of another entity type.", 
            true
        ),
        new Vocabulary(
            "One-to-Many", 
            "Type of Cardinality", 
            "A type of cardinality where one instance of an entity type is related to many instances of another entity type.", 
            true
        ),
        new Vocabulary(
            "Many-to-Many", 
            "Type of Cardinality", 
            "A type of cardinality where many instances of an entity type are related to many instances of another entity type.", 
            false
        ),
        new Vocabulary(
            "Recursive Relationship", 
            "Type of Relationship", 
            "A relationship where the same entity type appears more than once.", 
            false
        )
    ],
    
    assessmentProgress: [
        new Assessment(
            "Assessment 1: Multiple Choice", 
            "Multiple Choice", 
            "Correctly answer at least 80% of the questions.", 
            true
        ),
        new Assessment(
            "Assessment 2: Short Answer", 
            "Short Answer", 
            "Provide clear and concise answers to all questions.", 
            false
        )
    ],
    currentAssessmentIndex: 1,
    
    RegionProgress: [
        new Region(
            "Schema City", 
            "Professor ER", 
            new RegionQuestHook(
                "Meet with Professor ER to learn about the basics of cardinality and its importance in database design.", 
                "Quest 1.1: Understand Cardinality"
            ), 
            true
        ),
        new Region(
            "ER Diagrams Village", 
            "Village Elder", 
            new RegionQuestHook(
                "Visit the Village Elder to learn about representing cardinality in ER diagrams.", 
                "Quest 2.1: Draw ER Diagrams with Cardinality"
            ), 
            false
        ),
        new Region(
            "Recursive Relationships Ruins", 
            "Ruins Guardian", 
            new RegionQuestHook(
                "Explore the ruins to learn about recursive relationships and their representation in ER diagrams.", 
                "Quest 3.1: Understand Recursive Relationships"
            ), 
            false
        )
    ],
    currentRegionIndex: 1,
    
    encounteredEncounters: [
        new Encounter(
            "Cardinality Conundrum", 
            "Multiple Choice", 
            new EncounterReward(
                "Cardinality Badge", 
                "Increases understanding of cardinality by 10%"
            ), 
            true
        )
    ],
    encountersNames: ["Cardinality Conundrum"],
    
    rewardGained: [
        new Reward(
            "Cardinality Badge", 
            "Increases understanding of cardinality by 10%", 
            true
        )
    ],
    gainedRewardsNames: ["Cardinality Badge"]
});

console.log('Mock user data loaded:', mockUser);

export default mockUser;