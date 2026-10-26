const axios = require('axios');

module.exports = async function (sock, chatId, message, city) {
    try {
        const apiKey = '4902c0f2550f58298ad4146a92b65e10';  // Replace with your OpenWeather API Key
        const response = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`);
        const weather = response.data;
        const tempC = Math.round(weather.main.temp);
        const tempF = Math.round((weather.main.temp * 9/5) + 32);
        const condition = (weather.weather[0]?.description || 'Clear').toUpperCase();
        const country = weather.sys?.country ? `, ${weather.sys.country}` : '';
        const humidity = weather.main?.humidity ?? 'N/A';
        const wind = weather.wind?.speed ?? '0';

        const weatherText = `╭─ *🌤️ 𝗭𝗢𝗫𝗘𝗥 𝗪𝗘𝗔𝗧𝗛𝗘𝗥*
┃
┃  ◈ *𝗟𝗢𝗖𝗔𝗧𝗜𝗢𝗡*
┃  ◆ *${weather.name}${country}*
┃  ◈ *𝗖𝗢𝗡𝗗𝗜𝗧𝗜𝗢𝗡*
┃  ◆ *${condition}*
┃  ◈ *𝗧𝗘𝗠𝗣𝗘𝗥𝗔𝗧𝗨𝗥𝗘*
┃  ◆ *${tempC}°C (${tempF}°F)*
┃  ◈ *𝗛𝗨𝗠𝗜𝗗𝗜𝗧𝗬*
┃  ◆ *${humidity}%*
┃  ◈ *𝗪𝗜𝗡𝗗 𝗦𝗣𝗘𝗘𝗗*
┃  ◆ *${wind} m/s*
┃
╰───────────────`;
        await sock.sendMessage(chatId, { text: weatherText }, { quoted: message });
    } catch (error) {
        console.error('Error fetching weather:', error);
        await sock.sendMessage(chatId, { text: 'Sorry, I could not fetch the weather right now.' }, { quoted: message } );
    }
};
