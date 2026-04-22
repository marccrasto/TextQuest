class LevelQuest {
    constructor(title, description, items = [], abilities = [], dependencies = [], isCompleted = false) {
        this.title = title;
        this.description = description;
        this.items = items;             // array of strings
        this.abilities = abilities;     // array of strings
        this.dependencies = dependencies; // array of strings
        this.isCompleted = isCompleted; // boolean
    }
}

class Level {
    constructor(name, overview, quests = [], isCompleted = false) {
        this.name = name;
        this.overview = overview;
        this.quests = quests;           // array of LevelQuest
        this.isCompleted = isCompleted; // boolean
    }
}

class Vocabulary {
    constructor(term, type, description, isLearned = false) {
        this.term = term;
        this.type = type;
        this.description = description;
        this.isLearned = isLearned; // boolean
    }
}

class Assessment {
    constructor(name, format, success_condition, isPassed = false) {
        this.name = name;
        this.format = format;
        this.success_condition = success_condition;
        this.isPassed = isPassed; // boolean
    }
}

class Introduction {
    constructor(description, questHook) {
        this.description = description;
        this.questHook = questHook;
    }
}

class RegionQuestHook {
    constructor(description, quest) {
        this.description = description;
        this.quest = quest;
    }
}

class Region {
    constructor(name, npc, questHook, isExplored = false) {
        this.name = name;
        this.npc = npc;
        this.questHook = questHook; // instance of RegionQuestHook
        this.isExplored = isExplored;
    }
}

class EncounterReward {
    constructor(name, benefit) {
        this.name = name;
        this.benefit = benefit;
    }
}

class Encounter {
    constructor(name, mechanic, reward, isCompleted = false) {
        this.name = name;
        this.mechanic = mechanic;
        this.reward = reward; // instance of EncounterReward
        this.isCompleted = isCompleted;
    }
}

class Reward {
    constructor(name, benefit, isClaimed = false) {
        this.name = name;
        this.benefit = benefit;
        this.isClaimed = isClaimed;
    }
}



class NarrativeOutput {
    constructor(introduction, regions = [], encounters = [], rewards = []) {
        this.introduction = introduction; // instance of Introduction
        this.regions = regions;           // array of Region
        this.encounters = encounters;     // array of Encounter
        this.rewards = rewards;           // array of Reward
    }
}

class NarrativeData {
    constructor(levels = [], vocabulary = [], assessments = []) {
        this.levels = levels;           // array of Level
        this.vocabulary = vocabulary;   // array of Vocabulary
        this.assessments = assessments; // array of Assessment
    }
}

class NarrativeStructure {
    constructor(data, output) {
        this.data = data;     // instance of NarrativeData
        this.output = output; // instance of NarrativeOutput
    }
}

class User {
    constructor({
        id = "",
        name = "",
        email = "",
        levelProgress = [],
        completedLevelsNames = [],
        currentQuest = "",
        levelsLeft = 0,
        currentLevel = 0,
        vocabularyProgress = [],
        assessmentProgress = [],
        currentAssessmentIndex = 0,
        RegionProgress = [],
        currentRegionIndex = 0,
        encounteredEncounters = [],
        encountersNames = [],
        rewardGained = [],
        gainedRewardsNames = []
    } = {}) {
        this.id = id;
        this.name = name;
        this.email = email;
        this.levelProgress = levelProgress;               // array of Level
        this.completedLevelsNames = completedLevelsNames; // array of strings
        this.currentQuest = currentQuest;
        this.levelsLeft = levelsLeft;
        this.currentLevel = currentLevel;
        this.vocabularyProgress = vocabularyProgress;     // array of Vocabulary
        this.assessmentProgress = assessmentProgress;     // array of Assessment
        this.currentAssessmentIndex = currentAssessmentIndex;
        this.RegionProgress = RegionProgress;             // array of Region
        this.currentRegionIndex = currentRegionIndex;
        this.encounteredEncounters = encounteredEncounters; // array of Encounter
        this.encountersNames = encountersNames;             // array of strings
        this.rewardGained = rewardGained;                   // array of Reward
        this.gainedRewardsNames = gainedRewardsNames;       // array of strings
    }
}

// ----------------- Export Classes -----------------
export {
    LevelQuest, 
    Level, 
    Vocabulary, 
    Assessment,
    Introduction, 
    RegionQuestHook, 
    Region,
    EncounterReward, 
    Encounter, 
    Reward,
    NarrativeOutput, 
    NarrativeData, 
    NarrativeStructure,
    User
};
