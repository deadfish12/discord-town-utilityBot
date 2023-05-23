const axios = require('axios');
const client = axios.create({
    validateStatus: function (status) {
        return status < 500; 
    }
})
async function createThread(prompt, interaction){
    const thread = await interaction.channel.threads.create({
        name: `${prompt}`,
        autoArchiveDuration: 60,
        reason: `Ask ${prompt}`
    });

    await thread.members.add(interaction.user.id);
    return thread;
}   

async function storeHistory(thread, lastMessage){
    if(history[thread.id]){
        history[thread.id].push(lastMessage);
    }
    else{
        history[thread.id] = [lastMessage];
    }
}
function splitString(str, limit = 2000, delimiter = "\n"){    
    if(str.length <= limit){
        return [str];
    }
    const result = [];
    const words = str.split(delimiter);
    let currentString = "";
    for(let i = 0;i<words.length;i++){
        if(currentString.length + words[i].length < limit){
            currentString += words[i] + delimiter;
        }else{
            result.push(currentString);
            currentString = words[i] + delimiter;
        }
    }
    result.push(currentString);
    return result;
}

async function getCompletion(prompt, history){
    const headers = {
        "Cache-Control": "no-cache, must-revalidate",
        "Content-Type": "application/json",
        "api-key": process.env.GPT_KEY
    }
    const body = {
        "model": "gpt-4",
        "messages": [...history, {"role": "user", "content": prompt}]
    }
    const response = await client.post(process.env.GPT_LINK, body, {headers: headers});
    if(response.status >= 400){
        return {
            success: false,
            message: splitString(response.data.error.message)
        }
    }
    return {message: splitString(response.data.choices[0].message.content), success: true};
}

let history = {};

module.exports = {

    run: async function(bot, interaction){
        const prompt = interaction.options.get("prompt")?.value ?? "Are you here? What's your name?";
        const shouldContinue = interaction.options.get("continue")?.value ?? false;
        await interaction.deferReply();
        
        interaction.editReply({content: `Q: ${prompt}\r\n\r\n`});
        
        const result = await getCompletion(prompt, history[interaction.channel.id] ?? []);
        for(let i = 0;i<result.message.length;i++){
            interaction.channel.send({content: `${result.message[i]}`});
        }
        if(!result.success || !shouldContinue) return;

        const thread = await createThread(prompt, interaction);
        await thread.join();

        storeHistory(thread, {role: "user", content: prompt});
        storeHistory(thread, {role: "assistant", content: result.message.join("\n")});

        const collectorFilter = (message) => {
            return message.author.id !== bot.user.id;
        }
        const collector = thread.createMessageCollector({ filter: collectorFilter, time: 600000 });

        collector.on('collect', async (message) => {
            const result = await getCompletion(message.content, history[message.channel.id] ?? []);
            for(let i = 0; i<result.message.length;i++){
                message.channel.send({content: `${result.message[i]}`});
            }
            storeHistory(message.channel, {role: "user", content: message.content});
            storeHistory(message.channel, {role: "assistant", content: result.message.join("\n")});

            console.log(history[message.channel.id]);
        });

        collector.on('end', async (collected, reason) => {
            thread.delete();
            delete history[thread.id];
        });
    }
}